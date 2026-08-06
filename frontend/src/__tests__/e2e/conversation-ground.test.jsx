/**
 * The conversation-ground token layer (28-messaging-v2.md §6, 29-sahayak.md §5).
 *
 * WHY THIS FILE EXISTS AT ALL. Fourteen token names are a CONTRACT: Sanvaad and
 * Sahayak are being built on top of them by other hands, and `.m2log` /
 * `.sh__thread` reference them by name. Every failure mode in this layer is
 * SILENT — an unresolved var() returns the guaranteed-invalid value, CSS drops
 * the whole declaration, and a log renders with no texture and no error. There
 * is no console warning to notice and nothing red to click.
 *
 * `scripts/check-tokens.mjs` gates the two general cases (referenced-and-never-
 * declared, declared-in-one-theme-only). This file gates the three that are
 * specific to THIS layer and that no general script can know about:
 *
 *   · the scope hazard — a var() is substituted at the element that DECLARES
 *     it, and both consuming surfaces sit inside `.k-surface-theme`;
 *   · `none` must clear BOTH the small and the large motif;
 *   · the attributes must be written on every render and on first paint, or the
 *     variant rules never match and the :root floor is what ships.
 *
 * Static assertions over CSS text and source, plus one jsdom run of applyPrefs.
 * jsdom applies no author CSS, so nothing here is a rendering claim.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { allCssRules, stripComments, readStyle } from './_harness';
import { applyPrefs, DEFAULTS } from '../../components/CustomizePanel';
import {
  CONV_PATTERNS, CONV_GROUNDS,
  DEFAULT_CONV_PATTERN, DEFAULT_CONV_GROUND,
  normalizeConvPattern, normalizeConvGround,
} from '../../lib/convGround';

const RULES = allCssRules();

/** Every `--x: value` in the blocks whose selector list is exactly `sel`. */
function declaredBy(sel) {
  const out = {};
  for (const r of RULES) {
    if (r.selector !== sel) continue;
    for (const m of r.body.matchAll(/(?:^|[;{])\s*(--[\w-]+)\s*:\s*([^;]+)/g)) {
      out[m[1]] = m[2].trim().replace(/\s+/g, ' ');
    }
  }
  return out;
}

const LIGHT = declaredBy('[data-theme="light"]');
const DARK = declaredBy('[data-theme="dark"]');

const MOTIFS = ['--motif-jaali', '--motif-patola', '--motif-star', '--motif-lines', '--motif-lg'];
const SHADOWS = ['--shadow-card', '--shadow-block', '--shadow-seat', '--shadow-bubble'];
const DEFAULTED = [
  '--conv-ground', '--conv-motif', '--conv-motif-size',
  '--conv-motif-lg', '--conv-motif-size-lg',
];

describe('conversation ground · the fourteen names are a contract', () => {
  it('declares every name the two surfaces reference', () => {
    // Sanvaad's `.m2log` and Sahayak's `.sh__thread` / `.sh__cp` / `.sh-card` /
    // `.sh__p` / `.sh__fig` / `.m2m__b` reference exactly these. A name missing
    // here is a surface that renders bare.
    const all = stripComments(
      [...new Set(RULES.map(r => r.file))].map(readStyle).join('\n')
    );
    for (const token of [...MOTIFS, ...SHADOWS, ...DEFAULTED]) {
      expect(all, `${token} is referenced by the prototype and must be declared`)
        .toMatch(new RegExp(`${token}\\s*:`));
    }
  });

  it('declares the motifs and the element shadows in BOTH themes', () => {
    for (const token of [...MOTIFS, ...SHADOWS]) {
      expect(LIGHT[token], `${token} missing from [data-theme="light"]`).toBeTruthy();
      expect(DARK[token], `${token} missing from [data-theme="dark"]`).toBeTruthy();
    }
  });

  it('gives dark its own values rather than reusing the warm ones', () => {
    // The point of tokenising these at all. A warm stroke sampled from cream
    // turns muddy on #0C0E11, and a warm rgba() shadow on a dark ground is a
    // smudge — so an identical value in both themes means the flip was skipped.
    for (const token of [...MOTIFS, ...SHADOWS]) {
      expect(DARK[token], `${token} is identical in both themes`).not.toBe(LIGHT[token]);
    }
    // Concretely: the cool stroke in dark, the warm stroke in light.
    for (const token of MOTIFS) {
      expect(LIGHT[token]).toContain('%238C7F63');
      expect(DARK[token]).toContain('%239FB0C4');
    }
  });

  it('scopes the theme blocks to [data-theme], not to :root', () => {
    // `:root, [data-theme="light"]` reads as UNIVERSAL to the parity passes in
    // check-tokens.mjs and check-contrast.mjs, and a forgotten dark half then
    // fails nothing. Light-only, it is a build failure. index.html writes
    // data-theme in both branches of its try/catch, so the fallback costs
    // nothing — asserted below.
    const owners = RULES.filter(r => r.selectors.includes(':root'))
      .filter(r => MOTIFS.concat(SHADOWS).some(t => new RegExp(`${t}\\s*:`).test(r.body)));
    expect(owners.map(r => `${r.file}: ${r.selector}`)).toEqual([]);
  });
});

describe('conversation ground · the scope hazard', () => {
  /**
   * A custom property's var() is substituted at the element that DECLARES it.
   * `--conv-ground: var(--s-low)` on <html> freezes to the root's cream and is
   * inherited into the Slate scope unchanged — a warm cream log on a cool Slate
   * surface, with no error of any kind. SanvaadPage.jsx and SahayakTab.jsx both
   * carry `k-surface-theme`, and surface-theme.css re-declares --s-low,
   * --surface and --s-container on that class.
   */
  it('pairs every ground variant with a .k-surface-theme twin', () => {
    for (const g of CONV_GROUNDS) {
      const owning = RULES.filter(r =>
        r.selectors.some(s => s.includes(`[data-conv-ground="${g.id}"]`)) &&
        /--conv-ground\s*:/.test(r.body)
      );
      expect(owning.length, `no rule sets --conv-ground for "${g.id}"`).toBeGreaterThan(0);
      for (const r of owning) {
        expect(
          r.selectors.some(s => s.includes('.k-surface-theme')),
          `[data-conv-ground="${g.id}"] sets --conv-ground with no .k-surface-theme twin ` +
          `(${r.file}) — it will freeze to the root palette inside Sanvaad and Sahayak`
        ).toBe(true);
      }
    }
  });

  it('confirms .k-surface-theme really does redeclare the three grounds', () => {
    // If this ever stops being true the twin above is dead weight rather than a
    // fix, and this test says which.
    const scoped = readStyle('surface-theme.css');
    for (const token of ['--surface', '--s-low', '--s-container']) {
      expect(scoped).toMatch(new RegExp(`${token}\\s*:`));
    }
  });
});

describe('conversation ground · the pattern axis', () => {
  it('offers exactly the five the stylesheet declares', () => {
    // 28 §6's prose lists a sixth, `kamal`. The stylesheet declares five and the
    // stylesheet is the specification; 28 marks kamal "to be added". An option
    // whose tile does not exist paints nothing.
    expect(CONV_PATTERNS.map(p => p.id)).toEqual(['none', 'jaali', 'patola', 'star', 'lines']);
    for (const p of CONV_PATTERNS.filter(p => p.motif)) {
      const name = p.motif.replace(/^var\(|\)$/g, '');
      expect(MOTIFS, `${p.id} points at ${name}, which is not one of the five`).toContain(name);
    }
  });

  it('clears BOTH motifs on "none", and only the small one elsewhere', () => {
    const none = declaredBy('[data-conv-pattern="none"]');
    expect(none['--conv-motif']).toBe('none');
    expect(none['--conv-motif-lg'], 'Sahayak keeps its texture when the user asked for none')
      .toBe('none');

    for (const id of ['jaali', 'patola', 'star', 'lines']) {
      const rule = declaredBy(`[data-conv-pattern="${id}"]`);
      expect(rule['--conv-motif']).toBe(`var(--motif-${id})`);
      expect(rule['--conv-motif-size'], `${id} sets a motif without its tile size`).toBeTruthy();
      // The size must match the tile the SVG actually draws, or the pattern
      // repeats mid-figure. Read off the width attribute in the data URI.
      const w = /width='(\d+)'/.exec(LIGHT[`--motif-${id}`])[1];
      expect(rule['--conv-motif-size']).toBe(`${w}px ${w}px`);
    }
  });
});

describe('conversation ground · the preference reaches the document', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-conv-pattern');
    document.documentElement.removeAttribute('data-conv-ground');
  });
  afterEach(() => {
    document.documentElement.removeAttribute('data-conv-pattern');
    document.documentElement.removeAttribute('data-conv-ground');
  });

  it('ships the prototype default to a user who never opens the setting', () => {
    expect(DEFAULTS.convPattern).toBe(DEFAULT_CONV_PATTERN);
    expect(DEFAULTS.convGround).toBe(DEFAULT_CONV_GROUND);
    expect([DEFAULT_CONV_PATTERN, DEFAULT_CONV_GROUND]).toEqual(['jaali', 'warm']);
  });

  it('writes both attributes UNCONDITIONALLY, even with the keys absent', () => {
    // Not `if (prefs.convPattern)`. A default that is always written is what
    // makes the :root floor provably a floor.
    const { convPattern, convGround, ...withoutTheKeys } = DEFAULTS;
    applyPrefs(withoutTheKeys);
    expect(document.documentElement.getAttribute('data-conv-pattern')).toBe('jaali');
    expect(document.documentElement.getAttribute('data-conv-ground')).toBe('warm');
  });

  it('normalises a value an older build may have stored', () => {
    // `setPrefs` persists the whole object, so a retired value survives forever.
    // Written through raw it produces an attribute that matches no rule — the
    // data-language="hi" bug, which reads as a missing feature rather than a
    // bad value.
    expect(normalizeConvPattern('kamal')).toBe('jaali');
    expect(normalizeConvPattern(undefined)).toBe('jaali');
    expect(normalizeConvGround('sepia')).toBe('warm');
    expect(normalizeConvGround(null)).toBe('warm');
    // A real value is never touched.
    expect(normalizeConvPattern('star')).toBe('star');
    expect(normalizeConvGround('accent')).toBe('accent');

    applyPrefs({ ...DEFAULTS, convPattern: 'kamal', convGround: 'sepia' });
    expect(document.documentElement.getAttribute('data-conv-pattern')).toBe('jaali');
    expect(document.documentElement.getAttribute('data-conv-ground')).toBe('warm');
  });

  it('sets both attributes before first paint, in both branches of index.html', () => {
    // Without this the log paints jaali/warm and then snaps to the user's
    // choice at mount — the first-paint jump kartavaya-design.css documents for
    // --radius-base. The catch branch matters as much as the try: a corrupt
    // k_prefs must still produce a ground, not an unmatched attribute.
    const html = ['index.html', 'frontend/index.html']
      .map(p => { try { return readFileSync(p, 'utf8'); } catch { return null; } })
      .find(Boolean);
    expect(html, 'index.html not found from the test cwd').toBeTruthy();

    const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
    const [tryBranch, catchBranch] = script.split(/catch\s*\(/);
    for (const [name, branch] of [['try', tryBranch], ['catch', catchBranch]]) {
      expect(branch, `data-conv-pattern missing from the ${name} branch`)
        .toMatch(/data-conv-pattern/);
      expect(branch, `data-conv-ground missing from the ${name} branch`)
        .toMatch(/data-conv-ground/);
    }
    // The literals here are duplicated from lib/convGround.js because a
    // blocking inline script cannot import. If the default ever moves, it moves
    // in two places, and this is the assertion that says so.
    expect(script).toContain(`'${DEFAULT_CONV_PATTERN}'`);
    expect(script).toContain(`'${DEFAULT_CONV_GROUND}'`);
  });
});
