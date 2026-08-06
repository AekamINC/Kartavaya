/**
 * Dark mode and reduced motion.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE STROBE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `a11y.css` collapses `--ix` to `.001` under `prefers-reduced-motion: reduce`.
 * That is right for a one-shot transition — 250ms becomes 0.25ms, which reads
 * as "instant", which is what the user asked for.
 *
 * On an `infinite` animation it is a photosensitivity hazard. The loop does not
 * stop; it accelerates. Three were measured on this branch before they were
 * fixed:
 *
 *   `calc(2s   * var(--ix))` → 2.000ms →  ~500 Hz
 *   `calc(1.5s * var(--ix))` → 1.500ms →  ~666 Hz
 *   `calc(.8s  * var(--ix))` → 0.800ms → ~1250 Hz
 *
 * A user who set reduce-motion BECAUSE they are photosensitive got a strobe for
 * their trouble. `animations.css` states the rule in its own header — an
 * infinite animation keeps a FIXED duration and is STOPPED under reduce, never
 * scaled — and these tests are that rule made executable.
 *
 * The spec is not the authority here. `16-animations.md:44` MANDATES the bug:
 * its worked example is `animation: dmSpin calc(.7s * var(--ix)) linear
 * infinite`, and the reference `motion.css:117` implements it. The build is
 * right and the spec is wrong; `_SOURCE-MAP.md` records it. Do not "correct"
 * these tests toward the handover.
 *
 * ── Why this is asserted against the CSS text and not in a browser
 *
 * jsdom does not apply author stylesheets, so `getComputedStyle` and
 * `getAnimations()` return nothing useful — a runtime assertion here would pass
 * on a page with every animation broken. The real instrument is Playwright's
 * `emulateMedia({ reducedMotion: 'reduce' })` plus `getAnimations()`, which is
 * how the three timings above were measured. That needs a browser binary and a
 * dependency this repo cannot take (see the report). Parsing the stylesheets is
 * the strictly-weaker-but-real substitute: it cannot see cascade or
 * specificity, but the defect class it exists for — a declaration that scales
 * an infinite loop, or one with no reduce escape at all — is fully visible in
 * the text, and it runs in CI today with no browser.
 */
import { describe, it, expect } from 'vitest';
import {
  allCssRules, styleFiles, readStyle, readSource, stripComments, underReducedMotion,
} from './_harness';

/* ── The scan ─────────────────────────────────────────────────────────────── */

const RULES = allCssRules();

/** `animation: <name> <time> …` shorthand bodies, one per declaration. */
function animationDecls(body) {
  return [...body.matchAll(/(?:^|;)\s*animation\s*:([^;]*)/g)].map(m => m[1].trim());
}

const INFINITE = RULES.flatMap(r =>
  animationDecls(r.body)
    .filter(d => /\binfinite\b/.test(d))
    .map(decl => ({ ...r, decl })));

/**
 * Selectors neutralised inside a `prefers-reduced-motion: reduce` block.
 *
 * `animation: none`, a paused play state and a single iteration all stop a
 * loop; any of the three is an acceptable escape.
 */
const STOPPED = new Set(
  RULES.filter(underReducedMotion)
    .filter(r => /animation\s*:\s*none|animation-name\s*:\s*none|animation-play-state\s*:\s*paused|animation-iteration-count\s*:\s*1\b/.test(r.body))
    .flatMap(r => r.selectors),
);

/**
 * Infinite animations that are LOADING INDICATORS, exempt by design.
 *
 * `a11y.css` §9 sets out the reasoning and it is deliberate: a blanket
 * `* { animation-duration: 1ms !important }` reset was considered and rejected
 * because it would freeze the spinners, "removing the only feedback a slow
 * request has". WCAG 2.3.3 governs NON-ESSENTIAL animation; a spinner is
 * essential and is not decorative motion.
 *
 * Adding a selector here is a claim that it communicates progress. Anything
 * decorative — a pulse, a shimmer, a skeleton, a drifting watermark — does not
 * belong on this list and the test will say so.
 */
const LOADING_INDICATORS = new Set([
  '.au__spin',
  '.spin',
  '.prg--ind .prg__f',
  '.gr__spin',
  '[data-k-palette] .k-cmdk__spin',
  // `.k-spinner` used to carry `animation: none` under reduce and was the only
  // spinner in the build that did. That stop was removed deliberately —
  // editorial.css:3613 states it, and animations.css §9 is the policy: a frozen
  // spinner is a broken-looking page, and the progress text beside it already
  // carries the meaning. This entry records that review; the test flagged the
  // change, which is what it is for.
  '.k-spinner',
]);

/* ══════════════════════════════════════════════════════════════════════════
   1 · No infinite loop may be scaled by the motion token
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · reduced motion · no infinite animation strobes', () => {
  it('the scan found the animations it is supposed to be checking', () => {
    // A sweep over an empty list passes and proves nothing. This is the
    // assertion that fails if the CSS scanner ever stops working.
    expect(RULES.length).toBeGreaterThan(500);
    expect(INFINITE.length).toBeGreaterThan(8);
    expect(STOPPED.size).toBeGreaterThan(4);
  });

  it('NO infinite animation multiplies its duration by var(--ix)', () => {
    // The exact defect: --ix collapses to .001 under reduce, so this turns a
    // loop into a strobe instead of stopping it.
    const scaled = INFINITE
      .filter(r => /var\(\s*--ix\s*\)/.test(r.decl))
      .map(r => `${r.file}  ${r.selector}  { animation: ${r.decl} }`);

    expect(scaled, `infinite animations scaled by --ix:\n${scaled.join('\n')}`).toEqual([]);
  });

  it('no infinite animation resolves to a strobing frequency under reduce', () => {
    // The same rule stated as the measurement rather than the mechanism, so a
    // NEW way of arriving at a 2ms loop is caught too. --ix is .001 under
    // reduce; anything under 100ms of loop period is a flash, not an animation.
    const FLOOR_MS = 100;
    const IX_UNDER_REDUCE = 0.001;

    const strobes = [];
    for (const r of INFINITE) {
      const calc = r.decl.match(/calc\(\s*([\d.]+)(m?s)\s*\*\s*var\(\s*--ix\s*\)\s*\)/);
      if (!calc) continue;
      const base = parseFloat(calc[1]) * (calc[2] === 's' ? 1000 : 1);
      const effective = base * IX_UNDER_REDUCE;
      if (effective < FLOOR_MS) {
        strobes.push(`${r.file} ${r.selector} → ${effective.toFixed(3)}ms (~${Math.round(1000 / effective)}Hz)`);
      }
    }
    expect(strobes, `strobing under prefers-reduced-motion:\n${strobes.join('\n')}`).toEqual([]);
  });

  it('every DECORATIVE infinite animation is stopped under reduce', () => {
    // The belt to the braces above: even with a fixed duration, a decorative
    // loop must stop when the user has asked for less motion. WCAG 2.3.3.
    const running = INFINITE
      .filter(r => !r.selectors.some(s => STOPPED.has(s)))
      .filter(r => !r.selectors.some(s => LOADING_INDICATORS.has(s)))
      .map(r => `${r.file}  ${r.selector}`);

    expect(running, `decorative infinite animations with no reduce escape:\n${running.join('\n')}`)
      .toEqual([]);
  });

  it('the loading-indicator exemption is only spent on loading indicators', () => {
    // Stops the allow-list from becoming the place inconvenient selectors go.
    for (const sel of LOADING_INDICATORS) {
      expect(sel, `${sel} is exempt but does not look like a spinner or progress bar`)
        .toMatch(/spin|prg|load|progress/i);
    }
  });

  it('the exemption list has no dead entries', () => {
    // A stale allow-list hides the next real one. Every entry must correspond
    // to an infinite animation that actually exists.
    const live = new Set(INFINITE.flatMap(r => r.selectors));
    for (const sel of LOADING_INDICATORS) {
      expect(live.has(sel), `${sel} is exempted but no longer animates infinitely`).toBe(true);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 · The motion tokens themselves
   ══════════════════════════════════════════════════════════════════════════ */

describe('e2e · reduced motion · the token collapse', () => {
  const a11y = stripComments(readStyle('a11y.css'));

  it('reduce collapses travel to zero and duration to almost-zero', () => {
    // Via the media-aware rule scanner rather than a regex over the file. The
    // first version of this matched `@media … { … \n}` and broke the moment the
    // block's closing brace was indented — the assertion then reported "a11y.css
    // lost its reduced-motion block" about a file that had not changed.
    const blocks = RULES
      .filter(underReducedMotion)
      .filter(r => r.selectors.includes(':root'));

    expect(blocks.length, 'no :root block under prefers-reduced-motion').toBeGreaterThan(0);

    const all = blocks.map(r => r.body).join('\n');
    expect(all).toMatch(/--ix:\s*\.001/);
    expect(all).toMatch(/--motion-scale:\s*0/);

  });

  /**
   * The OS setting must beat the user's own animation preference, and the
   * mechanism that makes that true is a pair of `-user` twins.
   *
   * `applyPrefs` writes preferences INLINE on `documentElement`, and an inline
   * style outranks a media query. So writing `--ix` or `--motion-scale`
   * directly let a user preference silently defeat `prefers-reduced-motion` —
   * which is the OS-level accessibility setting, and must win.
   *
   * `a11y.css` used to contain this with `!important`, which beats inline and
   * did work. It has been removed on purpose in favour of the structural fix,
   * and that file now says "Do not reinstate the block". An earlier version of
   * THIS test asserted the `!important` form was present, which would have
   * pushed the next person to reinstate exactly what a sibling had just
   * correctly removed. Assert the invariant, not the workaround.
   */
  it('the writable half of each motion token is a -user twin', () => {
    const design = stripComments(readStyle('kartavaya-design.css'));
    expect(design).toMatch(/--ix:\s*var\(\s*--ix-user\s*\)/);
    expect(design).toMatch(/--motion-scale:\s*var\(\s*--motion-scale-user\s*\)/);
  });

  it('applyPrefs writes the -user twins and never the base tokens', () => {
    // The half that was broken. Writing `--motion-scale` inline made the
    // reduced-motion media query unable to apply at all.
    const panel = readSource('components/CustomizePanel.jsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(panel).toMatch(/setProperty\(\s*'--ix-user'/);
    expect(panel).toMatch(/setProperty\(\s*'--motion-scale-user'/);
    expect(panel, 'applyPrefs writes --ix inline, defeating the OS setting')
      .not.toMatch(/setProperty\(\s*'--ix'/);
    expect(panel, 'applyPrefs writes --motion-scale inline, defeating the OS setting')
      .not.toMatch(/setProperty\(\s*'--motion-scale'/);
  });

  /**
   * Every transition duration in the build is a token, and this is what keeps
   * it that way.
   *
   * `prefers-reduced-motion` is honoured GLOBALLY — the `:root` collapse above
   * sets `--ix: .001`, and one query owns every duration written as
   * `var(--dur-*)` or `calc(… * var(--ix))`. Which means a per-file reduce block
   * is not the mechanism and never was; a LITERAL is the only way a duration can
   * escape, because no media query can reach `transition: all .12s`.
   *
   * Ten had escaped, all in the two stylesheets that also carried no reduce
   * block of their own: `brand.css` (3) and `generate-report.css` (7). Both
   * fixed 2026-08-06, and the measured count is now zero — which is only worth
   * anything if the next literal fails a test instead of passing a review.
   *
   * `16-animations.md` §"Audit before you ship": every timing is either
   * `calc(… * var(--ix))` or a bug, with no third case.
   *
   * Scoped to `transition` on purpose. `animation` has a documented exception —
   * an infinite loop keeps a FIXED duration and is stopped outright, per §1
   * above — so the same rule stated over animations would contradict the four
   * tests at the top of this file.
   */
  it('no transition duration is a literal — a literal is the one thing reduce cannot reach', () => {
    const literals = [];
    for (const r of RULES) {
      for (const m of r.body.matchAll(/(?:^|[;{])\s*transition(?:-duration)?\s*:([^;}]*)/g)) {
        const decl = m[1];
        if (!/\d*\.?\d+m?s\b/.test(decl)) continue;           // no time at all
        if (/var\(\s*--(?:dur|ix)/.test(decl)) continue;      // rides the token
        literals.push(`${r.file}  ${r.selector}  { transition:${decl} }`);
      }
    }
    expect(literals, `transition durations no reduced-motion query can reach:\n${literals.join('\n')}`)
      .toEqual([]);
  });

  it('--ix is NOT collapsed to exactly 0', () => {
    // Deliberate, and the reason is in a11y.css: a zero-duration animation
    // never fires `animationend`, so any handler that unmounts on exit-complete
    // leaks its node. `tokens.css:241` in the reference zeroes it; the build is
    // right and the reference is wrong.
    expect(a11y).not.toMatch(/--ix:\s*0\s*!important/);
  });

  it('the skeleton shimmer specifically does not animate under reduce', () => {
    // Named because it is the one the owner reported: the shimmer strobed.
    const shimmerSelectors = INFINITE
      .filter(r => /shimmer|shim|skeleton|skel/i.test(r.selector + r.decl))
      .flatMap(r => r.selectors);

    expect(shimmerSelectors.length).toBeGreaterThan(0);
    for (const sel of shimmerSelectors) {
      expect(STOPPED.has(sel), `${sel} shimmers on under prefers-reduced-motion`).toBe(true);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 · Dark mode
   ══════════════════════════════════════════════════════════════════════════ */

/** Custom properties declared per theme, across every stylesheet. */
function themeTokens() {
  const light = new Map();
  const dark = new Map();
  for (const r of RULES) {
    const declared = [...r.body.matchAll(/(^|[;{])\s*(--[\w-]+)\s*:/g)].map(m => m[2]);
    if (!declared.length) continue;
    const isLight = r.selectors.some(s => s === ':root' || s === '[data-theme="light"]' || s === 'html');
    const isDark = r.selectors.some(s => s === '[data-theme="dark"]');
    if (isLight) declared.forEach(t => light.set(t, r.file));
    if (isDark) declared.forEach(t => dark.set(t, r.file));
  }
  return { light, dark };
}

describe('e2e · dark mode · both themes declare what they use', () => {
  const { light, dark } = themeTokens();

  it('the theme scan is not vacuous', () => {
    expect(light.size).toBeGreaterThan(100);
    expect(dark.size).toBeGreaterThan(50);
  });

  it('no token exists ONLY in dark — that is the --shadow-4 defect', () => {
    // `--shadow-4` was used in four files and defined in dark only, so the
    // drawer, the drag card, the admin sidebar and the mobile nav had no shadow
    // in light mode. An unresolved var() returns an empty string and CSS drops
    // the declaration silently, with no console warning. That is the whole
    // failure mode, and it is invisible to reading.
    const darkOnly = [...dark.keys()]
      .filter(t => !light.has(t))
      .map(t => `${t}  (declared in ${dark.get(t)} for dark only)`);

    expect(darkOnly, `tokens with no light-theme value:\n${darkOnly.join('\n')}`).toEqual([]);
  });

  it('every semantic container token has an on- partner in BOTH themes', () => {
    // A container without its `on-` colour is text the theme cannot make
    // readable. Three components were unreadable in one theme each for exactly
    // this reason.
    const PAIRS = ['primary', 'ok', 'warn', 'danger'];
    for (const p of PAIRS) {
      for (const [name, set] of [['light', light], ['dark', dark]]) {
        if (!set.has(`--${p}-container`)) continue;
        expect(set.has(`--on-${p}-container`), `--on-${p}-container missing in ${name}`).toBe(true);
      }
    }
  });

  it('dark is selected by [data-theme], not by a competing .dark class', () => {
    // Two mechanisms disagreed once: `lib/auth.js` toggled a `.dark` class while
    // CustomizePanel wrote [data-theme]. 00-tokens.md standardises on the
    // attribute; a resurrected class selector means the two can drift again.
    const all = styleFiles().map(f => stripComments(readStyle(f))).join('\n');
    expect(all).not.toMatch(/(^|[\s,}])(:root)?\.dark\s*[,{]/m);
  });

  it('the theme attribute is only ever "light" or "dark"', () => {
    // `mode: 'system'` used to be written straight through, producing
    // [data-theme="system"], which matches no rule — so system mode silently
    // rendered light.
    const all = styleFiles().map(f => stripComments(readStyle(f))).join('\n');
    const values = [...all.matchAll(/\[data-theme="([^"]+)"\]/g)].map(m => m[1]);
    expect([...new Set(values)].sort()).toEqual(['dark', 'light']);
  });
});
