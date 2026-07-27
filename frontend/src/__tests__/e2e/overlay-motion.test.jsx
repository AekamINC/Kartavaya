/**
 * Overlay motion — the exit contract, and the duplicate-keyframe hazard.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Six overlays shipped with an entrance and no exit: `modal.jsx`,
 * `ConfirmDialog.jsx`, `toast.jsx`, `Menu.jsx`, `CommandPalette.jsx`,
 * `KeyboardShortcuts.jsx` and the drawer's lightbox all ended with some form of
 * `if (!open) return null`. Each one rose into place over 220–360ms and then
 * ceased to exist between two frames.
 *
 * That class of defect is INVISIBLE TO READING, which is why it survived
 * several passes over these files. There is no wrong value to spot — there is
 * no declaration at all. It is only findable by asking "what is missing", which
 * is what the first two suites below do mechanically:
 *
 *   · every dismissible overlay that ANIMATES IN must also declare an exit
 *   · every exit must be strictly shorter than the entrance it reverses
 *
 * The third suite is the other bug this component set keeps producing: two
 * `@keyframes` under one name, or one animation under two names. Keyframes are
 * GLOBAL and the last declaration wins, so a duplicate silently retimes an
 * unrelated surface across the whole app. It has happened three times here —
 * `fadeIn` and `pulse` redeclared in animations.css over index.css's,
 * `dmPop` declared in both components.css and drawer.css, and `modalIn`, a
 * second name for a keyframe byte-identical to `dmFade`.
 *
 * ── Why this is asserted against the CSS text and not in a browser
 *
 * Same reason as theme-motion.test.jsx: jsdom applies no author stylesheets, so
 * `getComputedStyle` and `getAnimations()` see nothing here. The real instrument
 * is Playwright with `emulateMedia`, and every number below was FIRST measured
 * that way — the durations in the table are readings, not arithmetic. Parsing
 * the stylesheets is the strictly-weaker-but-real substitute that runs in CI
 * with no browser binary: it cannot see the cascade, but a missing exit and a
 * duplicated keyframe are both fully visible in the text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { allCssRules, styleFiles, readStyle, readSource, stripComments } from './_harness';

const SRC = path.resolve(__dirname, '../..');

/* ── Reading the token ladder ─────────────────────────────────────────────── */

/** `--dur-*` in ms at `--ix: 1`, from kartavaya-design.css §5. */
const DUR = {
  '--dur-instant': 90,
  '--dur-fast': 140,
  '--dur-base': 220,
  '--dur-slow': 360,
  '--dur-xslow': 520,
};

/**
 * The duration out of an `animation:` shorthand, in ms.
 *
 * Handles the three forms the build uses and nothing else, deliberately — an
 * `animation` value this cannot read is one nobody can reason about either:
 *   `var(--dur-fast)` · `calc(var(--dur-base) * .82)` · `640ms` / `1.7s`
 * Returns null when there is no time in the declaration at all.
 */
export function durationMs(decl) {
  const calc = decl.match(/calc\(\s*var\(\s*(--dur-[a-z]+)\s*\)\s*\*\s*([\d.]+)\s*\)/);
  if (calc) return DUR[calc[1]] * parseFloat(calc[2]);
  const token = decl.match(/var\(\s*(--dur-[a-z]+)\s*\)/);
  if (token) return DUR[token[1]];
  const literal = decl.match(/(?:^|\s)([\d.]+)(ms|s)(?:\s|$)/);
  if (literal) return parseFloat(literal[1]) * (literal[2] === 's' ? 1000 : 1);
  return null;
}

const RULES = allCssRules();

/** `animation: …` shorthand bodies on a rule, one per declaration. */
const animationDecls = (body) =>
  [...body.matchAll(/(?:^|;)\s*animation\s*:([^;]*)/g)].map(m => m[1].trim());

/** The first `animation:` on a rule, or null. */
const animationOf = (rule) => animationDecls(rule.body)[0] ?? null;

/* ══════════════════════════════════════════════════════════════════════════
   1 · Every dismissible overlay has an exit
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * What counts as a dismissible overlay: `position: fixed`, a z-index on the
 * 26 §4 ladder (199 and up — drawer scrim and above), and an entrance.
 *
 * Derived rather than listed, so an overlay added next month is covered without
 * anybody remembering to add it here. That matters: the list form of this test
 * is what a reviewer writes, and it is exactly the list that would not have
 * contained `.dr__lb` or `.k-shortcuts`.
 */
function overlayRules() {
  return RULES.filter((r) => {
    if (!/position\s*:\s*fixed/.test(r.body)) return false;
    if (r.selector.includes(':')) return false;                 // states, not surfaces
    if (r.selectors.some(s => s.includes('.is-closing'))) return false;
    if (!animationOf(r)) return false;
    const z = r.body.match(/z-index\s*:\s*(?:var\(\s*--z-[a-z-]+\s*\)|(\d+))/);
    if (!z) return false;
    return z[1] === undefined || Number(z[1]) >= 199;
  });
}

/**
 * The exit is a `.is-closing` rule whose selector is this one plus that class.
 * `.pop` → `.pop.is-closing`; `[data-k-palette] .k-cmdk` →
 * `[data-k-palette] .k-cmdk.is-closing`. Compound selectors are matched by
 * their last simple selector so the attribute-scoped palette rules resolve.
 */
const closingSelectors = new Set(
  RULES.filter(r => animationOf(r))
    .flatMap(r => r.selectors)
    .filter(s => s.includes('.is-closing'))
    .map(s => s.trim().split(/\s+/).pop()),
);

const hasExit = (rule) =>
  rule.selectors.some((s) => closingSelectors.has(`${s.trim().split(/\s+/).pop()}.is-closing`));

/**
 * Overlays that animate in and still have no exit, each with the reason it is
 * not fixed here rather than a silent omission.
 *
 * This list is meant to shrink and must never be added to casually: an entry is
 * a promise that somebody looked, not a way to quiet the test.
 *
 * `.k-modal` / `.k-modal-scrim` — `components/NewTaskModal.jsx`. Live, and the
 *   only overlay left with a hard `if (!open) return null`. It is also still on
 *   the retired `--ink` / `--rule` vocabulary and its durations are literals
 *   (`calc(.15s * var(--ix))`, `ease-out`), so it is mid-migration; wiring an
 *   exit into it now would collide with that work. `useExitAnimation` makes it
 *   an eight-line change once the repaint lands.
 *
 * `.k-cmdk-overlay` (editorial.css, NOT palette.css) — DEAD. Both components
 *   that render this class also set `data-k-palette`, and palette.css's
 *   `[data-k-palette].k-cmdk-overlay` is (0,2,0) against this rule's (0,1,0),
 *   so its `animation` has never applied to anything. It should be deleted with
 *   the rest of the legacy block, which palette.css's header already schedules.
 */
const EXIT_NOT_YET = new Set(['.k-modal', '.k-modal-scrim', '.k-cmdk-overlay']);

describe('e2e · overlays · nothing enters without a way out', () => {
  it('the scan found the overlays it is supposed to be checking', () => {
    // A sweep over an empty list passes and proves nothing.
    expect(RULES.length).toBeGreaterThan(500);
    expect(overlayRules().length).toBeGreaterThan(6);
    expect(closingSelectors.size).toBeGreaterThan(6);
  });

  it('every animated overlay declares an exit', () => {
    const naked = overlayRules()
      .filter(r => !hasExit(r))
      .filter(r => !r.selectors.some(s => EXIT_NOT_YET.has(s.trim().split(/\s+/).pop())))
      .map(r => `${r.file}  ${r.selector}  { animation: ${animationOf(r)} }`);

    expect(naked, `overlays that animate in and then vanish:\n${naked.join('\n')}`).toEqual([]);
  });

  it('the "not yet" list has no dead entries', () => {
    // A stale exemption hides the next real one — and two of these three are
    // waiting on migrations that will remove the selector entirely.
    const live = new Set(overlayRules().flatMap(r => r.selectors.map(s => s.trim().split(/\s+/).pop())));
    for (const sel of EXIT_NOT_YET) {
      expect(live.has(sel), `${sel} is exempted but is no longer an animated overlay`).toBe(true);
    }
  });

  it('every exit is strictly faster than the entrance it reverses', () => {
    // MOTION-SPEC §7.3, and the reason it is a rule: an exit that matches its
    // entrance reads as the surface being reluctant to leave. The reconciled
    // table in animations.css puts every `out` one duration step below its `in`.
    const slow = [];
    for (const r of overlayRules()) {
      const inMs = durationMs(animationOf(r));
      if (inMs == null) continue;
      for (const s of r.selectors) {
        const leaf = `${s.trim().split(/\s+/).pop()}.is-closing`;
        const exit = RULES.find(x => animationOf(x)
          && x.selectors.some(y => y.trim().split(/\s+/).pop() === leaf));
        if (!exit) continue;
        const outMs = durationMs(animationOf(exit));
        if (outMs == null || outMs < inMs) continue;
        slow.push(`${r.file} ${s}: in ${inMs}ms, out ${outMs}ms (${exit.selector})`);
      }
    }
    expect(slow, `exits that are not faster than their entrance:\n${slow.join('\n')}`).toEqual([]);
  });

  it('every exit duration comes off the --dur-* ladder', () => {
    // `calc(.2s * var(--ix))` DOES scale with --ix, so it is not the strobe bug
    // — it is the quieter one. A hand-picked 200ms base sits between two rungs
    // and belongs to no row of 26 §6, so it drifts on its own and nothing
    // reconciles it. The build's convention for a duration between rungs is a
    // fraction of the token its own entrance uses:
    // `calc(var(--dur-base) * .82)`, which is 180ms AND still on the ladder.
    const offLadder = RULES
      .filter(r => r.selectors.some(s => s.includes('.is-closing')))
      .flatMap(r => animationDecls(r.body).map(d => ({ r, d })))
      .filter(({ d }) => !/\bnone\b/.test(d))
      .filter(({ d }) => !/var\(\s*--dur-/.test(d) && /[\d.]+m?s/.test(d))
      .map(({ r, d }) => `${r.file}  ${r.selector}  { animation: ${d} }`);

    expect(offLadder, `exit durations off the token ladder:\n${offLadder.join('\n')}`).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 · The components behind those classes
   ══════════════════════════════════════════════════════════════════════════ */

/** Every .jsx under src/, walked once. */
function sourceFiles(dir = SRC, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (entry.name.endsWith('.jsx') || entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

const SOURCES = sourceFiles().map(f => ({
  file: path.relative(SRC, f).replace(/\\/g, '/'),
  text: readFileSync(f, 'utf8'),
}));

describe('e2e · overlays · the exit is driven by animationend, not a constant', () => {
  const renderers = SOURCES.filter(s => /'is-closing'|"is-closing"/.test(s.text));

  it('the scan found the components it is supposed to be checking', () => {
    expect(renderers.length).toBeGreaterThan(5);
  });

  it('every component that renders .is-closing also listens for animationend', () => {
    // The whole point of the class. Setting it and then unmounting on a timer
    // reproduces the bug in a more expensive way: the CSS duration is
    // `calc(140ms * var(--ix))` and no constant tracks a runtime preference.
    // Popover.jsx's header sets out what the mismatch costs at each setting.
    const deaf = renderers
      .filter(s => !/onAnimationEnd|useExitAnimation/.test(s.text))
      .map(s => s.file);

    expect(deaf, `components that set .is-closing but never hear it finish:\n${deaf.join('\n')}`)
      .toEqual([]);
  });

  it('every exit fallback is a ceiling, not a race', () => {
    // The fallback exists for the case where `animationend` cannot arrive at
    // all — the node is display:none'd, the tab is backgrounded mid-exit. Set
    // below the CSS duration it stops being a fallback and starts truncating
    // the animation, which is the bug these constants used to BE (a flat 130ms
    // against a 140ms exit, unmounting 10ms early on every close).
    // 360ms is the longest exit on the ladder (`--dur-slow`); anything at or
    // under it can fire first.
    const tooTight = [];
    for (const s of SOURCES) {
      for (const m of s.text.matchAll(/EXIT_FALLBACK_MS\s*=\s*(\d+)/g)) {
        if (Number(m[1]) <= 360) tooTight.push(`${s.file}: ${m[1]}ms`);
      }
      for (const m of s.text.matchAll(/fallbackMs\s*=\s*(\d+)/g)) {
        if (Number(m[1]) <= 360) tooTight.push(`${s.file}: fallbackMs ${m[1]}ms`);
      }
    }
    expect(tooTight, `exit fallbacks that can beat the animation:\n${tooTight.join('\n')}`)
      .toEqual([]);
  });

  it('an overlay that is click-through while leaving is so for all of them', () => {
    // Half-applied, this is worse than not applied: an exit runs for 119–220ms
    // with the node fully painted and still hit-testable, so whether a click
    // lands on the page or on the thing that is leaving depends on which
    // overlay you happened to dismiss.
    // `animation: none` rules are the reduced-motion stops, not exits — and
    // they are grouped (`.k-onboard, .k-onboard.is-closing { animation: none }`),
    // so counting them would demand `pointer-events` on the OPEN selector too.
    // Rules whose ONLY animation is `none` are the reduced-motion stops, not
    // exits — and they are grouped (`.k-onboard, .k-onboard.is-closing
    // { animation: none }`), so counting them would demand `pointer-events` on
    // the OPEN selector too. A rule with no `animation` at all is kept: that is
    // the shape of the shared `pointer-events: none` rule this test is reading.
    const closing = RULES
      .filter(r => r.selectors.some(s => s.includes('.is-closing')))
      .filter(r => {
        const decls = animationDecls(r.body);
        return decls.length === 0 || !decls.every(d => /\bnone\b/.test(d));
      });
    const clickThrough = new Set(
      closing.filter(r => /pointer-events\s*:\s*none/.test(r.body))
        .flatMap(r => r.selectors.map(s => s.trim().split(/\s+/).pop())),
    );

    // A panel inside a scrim inherits the scrim's `pointer-events: none`, so
    // only the outermost element of each overlay carries the declaration.
    // Each of these three is a direct child of a scrim that has it.
    const INHERITS_FROM_SCRIM = new Set([
      '.modal__panel.is-closing',   // inside .modal__scrim
      '.k-cmdk.is-closing',         // inside [data-k-palette].k-cmdk-overlay
      '.k-shortcuts.is-closing',    // inside [data-k-palette].k-cmdk-overlay
    ]);

    const solid = closing
      .filter(r => animationOf(r))
      .flatMap(r => r.selectors.map(s => s.trim().split(/\s+/).pop()))
      .filter(s => !clickThrough.has(s) && !INHERITS_FROM_SCRIM.has(s));

    expect([...new Set(solid)], `closing overlays that still swallow clicks:\n${solid.join('\n')}`)
      .toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 · Keyframes are global — one name, one animation, and vice versa
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Every `@keyframes` in the app, INCLUDING `src/index.css` and `src/App.css`.
 *
 * `styleFiles()` only walks `src/styles/`, and the original instance of this bug
 * was exactly a cross-directory one: animations.css redeclared `fadeIn` and
 * `pulse`, both of which live in `src/index.css`, and loaded later — so
 * `.anim-fade` silently gained a 10px rise and `pulse` ran inverted.
 */
function allKeyframes() {
  const files = [
    ...styleFiles().map(f => ({ file: `styles/${f}`, css: stripComments(readStyle(f)) })),
    { file: 'index.css', css: stripComments(readSource('index.css')) },
    { file: 'App.css', css: stripComments(readSource('App.css')) },
  ];
  const out = [];
  for (const { file, css } of files) {
    const re = /@keyframes\s+([A-Za-z0-9_-]+)\s*\{/g;
    let m;
    while ((m = re.exec(css))) {
      let depth = 1;
      let j = re.lastIndex;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth += 1;
        else if (css[j] === '}') depth -= 1;
        j += 1;
      }
      out.push({ file, name: m[1], body: css.slice(re.lastIndex, j - 1).replace(/\s+/g, '').toLowerCase() });
    }
  }
  return out;
}

const KEYFRAMES = allKeyframes();

/**
 * `rotate(360deg)` under five names, in five files.
 *
 * `dmSpin`, `auSpin`, `gr-spin`, `spin` and `k-cmdk-spin-v2` are the same
 * animation. Consolidating them means editing auth.css, generate-report.css,
 * editorial.css and palette.css — four surfaces, for no behavioural change,
 * and `spin` in particular is a name so generic that moving it risks the exact
 * collision this suite is about. Recorded here rather than papered over: the
 * duplication is real, it is bounded, and the test still blocks a SIXTH.
 */
const KNOWN_SPINNER_ALIASES = new Set(['dmSpin', 'auSpin', 'gr-spin', 'spin', 'k-cmdk-spin-v2']);

describe('e2e · keyframes · one global namespace, and it is shared', () => {
  it('the scan found the keyframes it is supposed to be checking', () => {
    expect(KEYFRAMES.length).toBeGreaterThan(30);
    expect(KEYFRAMES.some(k => k.file === 'index.css')).toBe(true);
  });

  it('no keyframe name is declared twice', () => {
    // The failure is silent and total: keyframes do not scope to a file, so the
    // later declaration wins for the WHOLE app. `dmPop` was declared in both
    // components.css and drawer.css, and animations.css opens its header with
    // this rule for that reason.
    const seen = new Map();
    const dupes = [];
    for (const k of KEYFRAMES) {
      if (seen.has(k.name)) dupes.push(`@keyframes ${k.name} — ${seen.get(k.name)} and ${k.file}`);
      else seen.set(k.name, k.file);
    }
    expect(dupes, `keyframe names declared more than once:\n${dupes.join('\n')}`).toEqual([]);
  });

  it('no two keyframe names describe the same animation', () => {
    // The other half. `@keyframes modalIn` was `from { opacity: 0 } to
    // { opacity: 1 }` — `dmFade` under a second name, so `.modal__scrim` looked
    // like it had its own fade and drifted off the scrim row in 26 §6 without
    // anybody noticing there was a row to be on.
    const byBody = new Map();
    for (const k of KEYFRAMES) {
      if (KNOWN_SPINNER_ALIASES.has(k.name)) continue;
      if (!byBody.has(k.body)) byBody.set(k.body, []);
      byBody.get(k.body).push(`${k.name} (${k.file})`);
    }
    const aliases = [...byBody.values()]
      .filter(names => names.length > 1)
      .map(names => names.join(' ≡ '));

    expect(aliases, `one animation under several names:\n${aliases.join('\n')}`).toEqual([]);
  });

  it('the spinner exemption has no dead entries', () => {
    // A stale allow-list hides the next real duplicate.
    const live = new Set(KEYFRAMES.map(k => k.name));
    for (const name of KNOWN_SPINNER_ALIASES) {
      expect(live.has(name), `${name} is exempted but no longer exists`).toBe(true);
    }
  });
});
